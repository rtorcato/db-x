# CouchDB example — placeholder

Not built yet. This directory reserves the path for the CouchDB example.

- **Exploration:** #42 (`[explore] Document stores: MongoDB + CouchDB`)

CouchDB is a document store, not a relational engine, so it won't mirror the
DDL-based [`examples/postgres/`](../postgres/) directly. Its declarative surface
(databases, design documents / views, Mango indexes, `_security` roles) does fit
DB-X's diff model, but needs a new `@db-x/couchdb-library` — HTTP/JSON driver,
not `psql` — which is still being explored (see #42). This path is reserved for
when it lands.
