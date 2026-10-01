-- Runs once, on first start of the `db` container (empty data volume).
-- POSTGRES_DB=blog already exists; create the integration-test database and enable pgvector in both.
CREATE DATABASE blog_test OWNER blog;

\connect blog
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect blog_test
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
