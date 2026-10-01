package queryscope

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

func ParseTagsJSON(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" || value == "null" || value == "[]" {
		return nil
	}
	var tags []string
	if err := json.Unmarshal([]byte(value), &tags); err != nil {
		return nil
	}
	return TagsFromJSON(tags)
}

// documentScopeSQL applies the same predicates as resultMatchesFilters before
// retrieval budgets are consumed. Values are always bound parameters.
func DocumentScopeSQL(alias string, filters *searchv1.SearchFilters, start int) (string, []any) {
	if filters == nil {
		return "", nil
	}
	clauses := []string{}
	args := []any{}
	bind := func(value any) string { args = append(args, value); return fmt.Sprintf("$%d", start+len(args)-1) }
	list := func(column string, values []string) {
		values = NormalizeLowerList(values)
		if len(values) == 0 {
			return
		}
		p := []string{}
		for _, value := range values {
			p = append(p, bind(value))
		}
		clauses = append(clauses, "lower(btrim(COALESCE("+alias+"."+column+", ''))) IN ("+strings.Join(p, ",")+")")
	}
	list("location_id", filters.LocationIds)
	list("sensor_id", filters.SensorIds)
	list("source_mac", FilterSourceMACs(filters))
	if filters.Bssid != "" {
		clauses = append(clauses, alias+".bssid = "+bind(strings.ToLower(strings.TrimSpace(filters.Bssid))))
	}
	if filters.ObservedApContextOnly {
		clauses = append(clauses, QualifyingAPSQL(alias))
	}
	if filters.EntityQuery != "" {
		clauses = append(clauses, EntityScopeSQL(alias, bind(strings.ToLower(strings.TrimSpace(filters.EntityQuery)))))
	}
	list("frame_subtype", filters.FrameSubtypes)
	list("proxy_event_type", filters.EventTypes)
	list("proxy_device_id::text", filters.ProxyDeviceIds)
	list("classification", filters.Classifications)
	for _, item := range []struct{ column, value string }{{"ssid", filters.Ssid}, {"host", filters.Host}} {
		if value := strings.TrimSpace(item.value); value != "" {
			clauses = append(clauses, "strpos(lower(COALESCE("+alias+"."+item.column+", '')), "+bind(strings.ToLower(value))+") > 0")
		}
	}
	if filters.Blocked != nil {
		clauses = append(clauses, alias+".blocked = "+bind(*filters.Blocked))
	}
	if filters.ObservedAfter != nil {
		clauses = append(clauses, alias+".observed_at >= "+bind(filters.ObservedAfter.AsTime()))
	}
	if filters.ObservedBefore != nil {
		clauses = append(clauses, alias+".observed_at < "+bind(filters.ObservedBefore.AsTime()))
	}
	if filters.SecurityFlagsMask != 0 {
		clauses = append(clauses, "("+alias+".security_flags & "+bind(filters.SecurityFlagsMask)+") <> 0")
	}
	if filters.HandshakeOnly {
		clauses = append(clauses, alias+".handshake_captured")
	}
	if filters.ThreatOnly {
		clauses = append(clauses, "("+alias+".handshake_captured OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE("+alias+".filters -> 'tags', '[]'::jsonb)) t(value) WHERE lower(btrim(t.value)) LIKE 'threat:%'))")
	}
	for _, tag := range NormalizeLowerList(filters.Tags) {
		clauses = append(clauses, "EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE("+alias+".filters -> 'tags', '[]'::jsonb)) t(value) WHERE lower(btrim(t.value)) = "+bind(tag)+")")
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " AND " + strings.Join(clauses, " AND "), args
}

func FilterSourceMACs(filters *searchv1.SearchFilters) []string {
	if filters == nil {
		return nil
	}
	values := make([]string, 0, 1+len(filters.SourceMacs))
	values = append(values, filters.SourceMac)
	values = append(values, filters.SourceMacs...)
	return NormalizeLowerList(values)
}

func NormalizeLowerList(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func EscapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func AddInClause(clauses *[]string, args *[]any, column string, values []any) {
	if len(values) == 0 {
		return
	}
	start := len(*args) + 1
	placeholders := PgPlaceholders(start, len(values))
	*clauses = append(*clauses, column+" IN ("+placeholders+")")
	*args = append(*args, values...)
}

func PgPlaceholders(start, count int) string {
	parts := make([]string, count)
	for i := range parts {
		parts[i] = fmt.Sprintf("$%d", start+i)
	}
	return strings.Join(parts, ",")
}

func StringsToAny(values []string) []any {
	out := make([]any, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}

func NormalizeGraphList(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func ContainsFold(values []string, value string) bool {
	value = strings.TrimSpace(value)
	for _, candidate := range values {
		if strings.EqualFold(strings.TrimSpace(candidate), value) {
			return true
		}
	}
	return false
}

func NullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	utc := value.Time.UTC()
	return &utc
}

var MacPattern = regexp.MustCompile(`^[0-9a-f]{2}(:[0-9a-f]{2}){5}$`)

func EntityScopeSQL(alias, placeholder string) string {
	return "(strpos(lower(COALESCE(" + alias + ".ssid,'')), " + placeholder + ") > 0 OR strpos(" + alias + ".source_mac," + placeholder + ") > 0 OR strpos(" + alias + ".bssid," + placeholder + ") > 0 OR EXISTS (SELECT 1 FROM atheros_search.devices reg WHERE reg.mac=" + alias + ".source_mac AND strpos(lower(COALESCE(reg.display_name,''))," + placeholder + ") > 0))"
}

// Count unknown roles as observed identifiers. Self, broadcast and unspecified
// addresses are excluded; one MAC can contribute independently to several APs.
func QualifyingAPSQL(alias string) string {
	return alias + `.observed_at IS NOT NULL AND ` + alias + `.source_mac ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'
 AND ` + alias + `.bssid ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'
 AND ` + alias + `.source_mac NOT IN ('ff:ff:ff:ff:ff:ff','00:00:00:00:00:00')
 AND ` + alias + `.bssid NOT IN ('ff:ff:ff:ff:ff:ff','00:00:00:00:00:00')
 AND ` + alias + `.source_mac <> ` + alias + `.bssid`
}

func TagsFromJSON(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	sort.Strings(out)
	return out
}
