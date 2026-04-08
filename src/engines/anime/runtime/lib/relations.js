const ID_RELATIONS_API_BASE = "https://relations.yuna.moe/api/v2";
const { fetchJson } = require("../../../../shared/fetch.cjs");

async function getImdbIdFromAnimeId(idType, id) {
  const source = idType === "mal" ? "myanimelist" : idType;
  const url = `${ID_RELATIONS_API_BASE}/ids?source=${source}&id=${id}&include=imdb`;
  const data = await fetchJson(url);
  if (data === undefined) {
    throw new Error("Invalid response!");
  }

  return data.imdb;
}

module.exports = {
  getImdbIdFromAnimeId
};
