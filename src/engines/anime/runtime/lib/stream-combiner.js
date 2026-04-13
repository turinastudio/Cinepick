export function combineStreams(streamGroups) {
  let combinedStreams = [];

  for (const group of streamGroups) {
    if (!Array.isArray(group) || group.length === 0) {
      continue;
    }

    const lastInternalCombined = combinedStreams.findLastIndex((stream) => stream.url !== undefined);
    const lastInternalGroup = group.findLastIndex((stream) => stream.url !== undefined);

    if (lastInternalGroup === -1) {
      combinedStreams = combinedStreams.concat(group);
      continue;
    }

    if (lastInternalCombined === -1) {
      combinedStreams = group.concat(combinedStreams);
      continue;
    }

    combinedStreams.splice(lastInternalCombined + 1, 0, ...group.slice(0, lastInternalGroup + 1));
    combinedStreams = combinedStreams.concat(group.slice(lastInternalGroup + 1));
  }

  return combinedStreams;
}
