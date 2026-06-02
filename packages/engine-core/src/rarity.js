export function computeRarityFromMetadata(metadataList) {
  const counts = {};
  const total = metadataList?.length || 0;

  for (const item of metadataList || []) {
    const meta = item?.metadata ?? item;
    const attrs = meta?.attributes || [];
    for (const attr of attrs) {
      counts[attr.trait_type] = counts[attr.trait_type] || {};
      counts[attr.trait_type][attr.value] =
        (counts[attr.trait_type][attr.value] || 0) + 1;
    }
  }

  const rarity = Object.entries(counts).map(([traitType, values]) => ({
    trait_type: traitType,
    values: Object.entries(values)
      .map(([value, count]) => ({
        value,
        count,
        percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => a.count - b.count),
  }));

  return { total, rarity };
}
