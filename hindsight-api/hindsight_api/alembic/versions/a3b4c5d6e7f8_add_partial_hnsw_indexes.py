"""Add partial HNSW indexes for per-fact_type semantic retrieval

Revision ID: a3b4c5d6e7f8
Revises: c3d4e5f6g7h8
Create Date: 2026-03-11

Creates partial HNSW indexes on memory_units.embedding partitioned by fact_type.
These indexes are required by retrieve_semantic_bm25_combined() which uses
UNION ALL of per-fact_type subqueries with ORDER BY embedding <=> $1 LIMIT n,
enabling HNSW index scans instead of the sequential scan that the previous
window-function approach forced.

Without partial indexes a global HNSW index with post-filtering by fact_type
returns near-zero results for minority fact_types (e.g., experience) because
the index returns nearest neighbours regardless of fact_type and the WHERE
filter then discards them.

Note: This migration uses CREATE INDEX IF NOT EXISTS (not CONCURRENTLY) because
Alembic migrations run inside a transaction.  For large deployments with existing
data, operators may prefer to create the indexes manually with CONCURRENTLY
before upgrading to avoid blocking writes during index build:

    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mu_emb_world
        ON memory_units USING hnsw (embedding vector_cosine_ops)
        WHERE fact_type = 'world';
    -- repeat for observation and experience

If the indexes already exist this migration is a no-op.
"""

from collections.abc import Sequence

from alembic import context, op

revision: str = "a3b4c5d6e7f8"
down_revision: str | Sequence[str] | None = "c3d4e5f6g7h8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _get_schema_prefix() -> str:
    schema = context.config.get_main_option("target_schema")
    return f'"{schema}".' if schema else ""


def upgrade() -> None:
    schema = _get_schema_prefix()
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_mu_emb_world "
        f"ON {schema}memory_units USING hnsw (embedding vector_cosine_ops) "
        f"WHERE fact_type = 'world'"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_mu_emb_observation "
        f"ON {schema}memory_units USING hnsw (embedding vector_cosine_ops) "
        f"WHERE fact_type = 'observation'"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS idx_mu_emb_experience "
        f"ON {schema}memory_units USING hnsw (embedding vector_cosine_ops) "
        f"WHERE fact_type = 'experience'"
    )


def downgrade() -> None:
    schema = _get_schema_prefix()
    op.execute(f"DROP INDEX IF EXISTS {schema}idx_mu_emb_world")
    op.execute(f"DROP INDEX IF EXISTS {schema}idx_mu_emb_observation")
    op.execute(f"DROP INDEX IF EXISTS {schema}idx_mu_emb_experience")
