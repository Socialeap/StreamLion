-- Public provider service pricing only. No grants, payment modes or project records change.
CREATE TABLE streamlion_provider_pricing_v1 (
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),
 google_subject TEXT NOT NULL,
 id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 config TEXT NOT NULL CHECK(json_valid(config) AND length(config)<=16000),
 version INTEGER NOT NULL CHECK(version>0),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(mode,google_subject,id)
);
