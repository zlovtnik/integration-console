package architecture

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestPackageBoundaries(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	const prefix = "github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/"
	allowed := map[string][]string{
		"apperror": {}, "queryscope": {}, "reportmeta": {},
		"assets":     {"apperror", "queryscope"},
		"reporting":  {"apperror", "queryscope", "reportmeta", "db", "metrics"},
		"savedviews": {"apperror", "reporting", "db"},
		"search":     {"apperror", "queryscope", "reportmeta", "reporting", "db", "embed", "config", "metrics"},
		"etlhealth":  {}, "worker": {"embed"},
		"db": {}, "auth": {}, "config": {"embed"}, "embed": {}, "health": {"db", "metrics"}, "metrics": {}, "observability": {}, "testdb": {},
	}
	err = filepath.WalkDir(filepath.Join(root, "internal"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		rel, _ := filepath.Rel(filepath.Join(root, "internal"), path)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		owner := parts[0]
		if owner == "utils" || owner == "common" {
			t.Errorf("generic helper package %s", rel)
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		for _, im := range file.Imports {
			name, err := strconv.Unquote(im.Path.Value)
			if err != nil {
				return err
			}
			if owner == "transport" && (name == "database/sql" || strings.HasPrefix(name, "github.com/jackc/pgx") || name == prefix+"db") {
				t.Errorf("%s: transports cannot import SQL/database clients", rel)
			}
			if !strings.HasPrefix(name, prefix) || owner == "app" || owner == "transport" {
				continue
			}
			target := strings.Split(strings.TrimPrefix(name, prefix), "/")[0]
			permitted := target == owner
			for _, dependency := range allowed[owner] {
				permitted = permitted || target == dependency
			}
			if !permitted {
				t.Errorf("%s: forbidden dependency %s -> %s", rel, owner, target)
			}
		}
		if owner == "transport" {
			ast.Inspect(file, func(node ast.Node) bool {
				if call, ok := node.(*ast.SelectorExpr); ok {
					switch call.Sel.Name {
					case "ExecContext", "QueryContext", "QueryRowContext", "BeginTx":
						t.Errorf("%s: transport executes SQL (%s)", rel, call.Sel.Name)
					}
				}
				return true
			})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
