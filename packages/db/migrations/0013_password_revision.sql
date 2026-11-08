ALTER TABLE accounts ADD COLUMN password_revision integer NOT NULL DEFAULT 0 CHECK (password_revision >= 0);
