/**
 * Hosted audit log. The deployed site cannot write files, so each decision is kept in the
 * Netlify Blobs store "review-audit" under <proposal-id>/<decidedAt>.json. Blobs is part of the Netlify plan.
 */
export async function saveAuditToBlobs(record: { proposalId: string; decidedAt: string }): Promise<boolean> {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: 'review-audit', consistency: 'strong' });
    await store.setJSON(`${record.proposalId}/${record.decidedAt}.json`, record);
    return true;
  } catch (error) {
    console.error('review-audit: could not save to Netlify Blobs', error instanceof Error ? error.message : error);
    console.log('review-audit record', JSON.stringify(record));
    return false;
  }
}
