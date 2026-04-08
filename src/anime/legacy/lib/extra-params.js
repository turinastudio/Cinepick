function parseExtraParams(extraParams, multipleGenres = false) {
  if (extraParams === undefined) {
    return {};
  }

  const paramMap = new Map();
  const genres = [];

  for (const keyVal of String(extraParams).split("&")) {
    const [param, value] = keyVal.split("=");
    if (!param) {
      continue;
    }

    if (multipleGenres && param === "genre") {
      genres.push(value);
      continue;
    }

    paramMap.set(param, value);
  }

  const result = Object.fromEntries(paramMap);
  if (multipleGenres) {
    result.genre = genres;
  }
  return result;
}

module.exports = {
  parseExtraParams
};
