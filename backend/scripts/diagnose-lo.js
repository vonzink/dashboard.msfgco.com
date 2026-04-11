#!/usr/bin/env node
/**
 * Diagnose LO visibility — run on EC2 to check a user's board access and item counts.
 *
 * Usage:
 *   node scripts/diagnose-lo.js Tracy
 *   node scripts/diagnose-lo.js "Zachary Zink"
 *   node scripts/diagnose-lo.js          # lists all LOs
 */
const db = require('../db/connection');

(async () => {
  try {
    const search = process.argv[2];

    if (!search) {
      const [users] = await db.query("SELECT id, name, email, role FROM users ORDER BY name");
      console.log('\nAll users:\n');
      for (const u of users) {
        console.log(`  [${u.id}] ${u.name} <${u.email}> role=${u.role}`);
      }
      console.log('\nUsage: node scripts/diagnose-lo.js <name>');
      process.exit(0);
    }

    const [users] = await db.query(
      "SELECT id, name, email, role FROM users WHERE name LIKE ? OR email LIKE ?",
      [`%${search}%`, `%${search}%`]
    );

    if (users.length === 0) {
      console.log(`No user found matching "${search}"`);
      process.exit(0);
    }

    for (const user of users) {
      console.log('\n' + '='.repeat(60));
      console.log(`USER: ${user.name} (id=${user.id}, email=${user.email}, role=${user.role})`);
      console.log('='.repeat(60));

      const userId = user.id;

      // Board access
      const [boards] = await db.query(
        `SELECT ba.board_id, mb.board_name, mb.target_section, mb.is_active
         FROM monday_board_access ba
         LEFT JOIN monday_boards mb ON ba.board_id = mb.board_id
         WHERE ba.user_id = ?
         ORDER BY mb.target_section, mb.board_name`,
        [userId]
      );

      console.log(`\nBoard Access (${boards.length} boards):`);
      if (boards.length === 0) {
        console.log('  ⚠️  NO board access entries — LO will only see items assigned directly to them');
      }
      for (const b of boards) {
        console.log(`  [${b.board_id}] ${b.board_name || '(unnamed)'} → ${b.target_section} (active=${b.is_active})`);
      }

      const boardIds = boards.map(b => b.board_id);
      const paBoardIds = boards.filter(b => b.target_section === 'pre_approvals').map(b => b.board_id);
      const flBoardIds = boards.filter(b => b.target_section === 'funded_loans').map(b => b.board_id);
      const plBoardIds = boards.filter(b => b.target_section === 'pipeline').map(b => b.board_id);

      // --- Pipeline ---
      const [pById] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id = ?', [userId]);
      const [pByName] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
      let pByBoard = 0;
      if (plBoardIds.length > 0) {
        const [r] = await db.query('SELECT COUNT(*) as cnt FROM pipeline WHERE source_board_id IN (?)', [plBoardIds]);
        pByBoard = r[0].cnt;
      }
      const [pTotal] = await db.query('SELECT COUNT(*) as cnt FROM pipeline');

      console.log(`\nPipeline (${pTotal[0].cnt} total):`);
      console.log(`  By assigned_lo_id = ${userId}: ${pById[0].cnt}`);
      console.log(`  By name fallback (NULL id, name="${user.name}"): ${pByName[0].cnt}`);
      console.log(`  On accessible boards: ${pByBoard}`);
      console.log(`  → Would see (new code): ${Math.max(pById[0].cnt + pByName[0].cnt, pByBoard)} (deduplicated in practice)`);

      // --- Pre-Approvals ---
      const [paById] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals WHERE assigned_lo_id = ?', [userId]);
      const [paByName] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
      let paByBoard = 0;
      if (paBoardIds.length > 0) {
        const [r] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals WHERE source_board_id IN (?)', [paBoardIds]);
        paByBoard = r[0].cnt;
      }
      const [paTotal] = await db.query('SELECT COUNT(*) as cnt FROM pre_approvals');

      console.log(`\nPre-Approvals (${paTotal[0].cnt} total):`);
      console.log(`  By assigned_lo_id = ${userId}: ${paById[0].cnt}`);
      console.log(`  By name fallback (NULL id, name="${user.name}"): ${paByName[0].cnt}`);
      console.log(`  On accessible boards: ${paByBoard}`);
      console.log(`  → Would see (new code): ${Math.max(paById[0].cnt + paByName[0].cnt, paByBoard)} (deduplicated in practice)`);

      // --- Funded Loans ---
      const [flById] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans WHERE assigned_lo_id = ?', [userId]);
      const [flByName] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans WHERE assigned_lo_id IS NULL AND LOWER(TRIM(assigned_lo_name)) = LOWER(TRIM(?))', [user.name]);
      let flByBoard = 0;
      if (flBoardIds.length > 0) {
        const [r] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans WHERE source_board_id IN (?)', [flBoardIds]);
        flByBoard = r[0].cnt;
      }
      const [flTotal] = await db.query('SELECT COUNT(*) as cnt FROM funded_loans');

      console.log(`\nFunded Loans (${flTotal[0].cnt} total):`);
      console.log(`  By assigned_lo_id = ${userId}: ${flById[0].cnt}`);
      console.log(`  By name fallback (NULL id, name="${user.name}"): ${flByName[0].cnt}`);
      console.log(`  On accessible boards: ${flByBoard}`);
      console.log(`  → Would see (new code): ${Math.max(flById[0].cnt + flByName[0].cnt, flByBoard)} (deduplicated in practice)`);

      // Unresolved names on their boards
      if (boardIds.length > 0) {
        for (const table of ['pipeline', 'pre_approvals', 'funded_loans']) {
          const [unresolved] = await db.query(
            `SELECT DISTINCT assigned_lo_name FROM ${table} WHERE source_board_id IN (?) AND assigned_lo_id IS NULL AND assigned_lo_name IS NOT NULL`,
            [boardIds]
          );
          if (unresolved.length > 0) {
            console.log(`\n  Unresolved LO names on boards (${table}): ${unresolved.map(r => `"${r.assigned_lo_name}"`).join(', ')}`);
          }
        }
      }

      // Processor-LO assignments
      const [procAssign] = await db.query('SELECT lo_user_id FROM processor_lo_assignments WHERE processor_user_id = ?', [userId]);
      if (procAssign.length > 0) {
        console.log(`\nProcessor→LO assignments: ${procAssign.map(a => a.lo_user_id).join(', ')}`);
      }
      const [assignedTo] = await db.query(
        'SELECT pla.processor_user_id, u.name FROM processor_lo_assignments pla LEFT JOIN users u ON pla.processor_user_id = u.id WHERE pla.lo_user_id = ?',
        [userId]
      );
      if (assignedTo.length > 0) {
        console.log(`\nProcessors assigned to this LO: ${assignedTo.map(a => `${a.name} (${a.processor_user_id})`).join(', ')}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
