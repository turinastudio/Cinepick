function normalizeTypeLabel(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase();
}

function isMovieTypeLabel(value) {
  const normalized = normalizeTypeLabel(value);
  return normalized === "pelicula" || normalized === "especial" || normalized === "movie";
}

module.exports = {
  isMovieTypeLabel,
  normalizeTypeLabel
};
