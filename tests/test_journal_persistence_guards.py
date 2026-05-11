import subprocess
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_node(script: str) -> str:
    result = subprocess.run(
        ["node", "--input-type=module", "-e", textwrap.dedent(script)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def test_authenticated_mode_beats_local_demo_flag():
    run_node(
        """
        import assert from 'node:assert/strict';
        import { authenticatedModePrefersSupabase } from './trading-ui/src/services/journalPersistenceGuards.js';

        assert.equal(
          authenticatedModePrefersSupabase({
            isAuthenticated: true,
            supabaseConfigured: true,
            localDemoFlag: 'true',
          }),
          true
        );
        assert.equal(
          authenticatedModePrefersSupabase({
            isAuthenticated: false,
            supabaseConfigured: true,
            localDemoFlag: 'true',
          }),
          false
        );
        """
    )


def test_verified_row_remains_loaded_after_save_reload():
    run_node(
        """
        import assert from 'node:assert/strict';
        import { reconcileVerifiedRowAfterReload } from './trading-ui/src/services/journalPersistenceGuards.js';

        const row = { id: 'trade-1', symbol: 'TATA.NS' };
        const result = reconcileVerifiedRowAfterReload({
          loadedRows: [row],
          verifiedRowId: 'trade-1',
          exactRow: null,
        });

        assert.equal(result.foundInReload, true);
        assert.equal(result.mergedExactRow, false);
        assert.equal(result.rows[0].id, 'trade-1');
        """
    )


def test_verified_row_missing_from_broad_reload_is_merged_from_exact_lookup():
    run_node(
        """
        import assert from 'node:assert/strict';
        import { reconcileVerifiedRowAfterReload } from './trading-ui/src/services/journalPersistenceGuards.js';

        const result = reconcileVerifiedRowAfterReload({
          loadedRows: [{ id: 'older-trade', symbol: 'BTCUSDT' }],
          verifiedRowId: 'trade-2',
          exactRow: { id: 'trade-2', symbol: 'RELIANCE.NS' },
        });

        assert.equal(result.foundInReload, false);
        assert.equal(result.mergedExactRow, true);
        assert.equal(result.missingAfterExactLookup, false);
        assert.deepEqual(result.rows.map((row) => row.id), ['trade-2', 'older-trade']);
        """
    )


def test_mixed_imported_and_iso_dates_sort_chronologically():
    run_node(
        """
        import assert from 'node:assert/strict';
        import { tradeDateSortValue } from './trading-ui/src/services/journalPersistenceGuards.js';

        assert.ok(tradeDateSortValue('2026-05-11') > tradeDateSortValue('9/9/25'));
        assert.ok(tradeDateSortValue('9/9/25') > tradeDateSortValue('7/21/25'));
        """
    )
