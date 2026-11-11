-- New "cookbook" site section. ADD VALUE may run inside the migration transaction (PostgreSQL 12+) because nothing here uses the new value.
ALTER TYPE "public"."post_section" ADD VALUE IF NOT EXISTS 'cookbook';
