const ID_RELATIONS_API_BASE = "https://relations.yuna.moe/api/v2";

async function getImdbIdFromAnimeId(idType, id) {
  const source = idType === "mal" ? "myanimelist" : idType;
  const url = `${ID_RELATIONS_API_BASE}/ids?source=${source}&id=${id}&include=imdb`;
  const response = await fetch(url);

  if (!response || !response.ok || response.status !== 200) {
    throw new Error(`HTTP error! Status: ${response?.status}`);
  }

  const data = await response.json();
  if (data === undefined) {
    throw new Error("Invalid response!");
  }

  return data.imdb;
}

module.exports = {
  getImdbIdFromAnimeId
};
