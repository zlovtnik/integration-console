package db

import (
	"database/sql"
	"errors"
)

func Require(pool *sql.DB) error {
	if pool == nil {
		return errors.New("postgres pool is not initialized")
	}
	return nil
}
