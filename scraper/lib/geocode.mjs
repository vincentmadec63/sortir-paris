// Repli de géolocalisation quand une source ne fournit pas de coordonnées
// précises : centroïde de l'arrondissement (Paris) ou du département
// (couronne), à partir du code postal. Suffisant pour une carte en clusters,
// pas pour une adresse exacte — pas besoin d'API de géocodage payante pour ça.

const PARIS_ARRONDISSEMENT_CENTROIDS = {
  1: [48.8606, 2.3376], 2: [48.8686, 2.3410], 3: [48.8630, 2.3620], 4: [48.8546, 2.3567],
  5: [48.8448, 2.3471], 6: [48.8496, 2.3320], 7: [48.8566, 2.3123], 8: [48.8718, 2.3075],
  9: [48.8768, 2.3372], 10: [48.8760, 2.3600], 11: [48.8570, 2.3800], 12: [48.8398, 2.3874],
  13: [48.8322, 2.3559], 14: [48.8321, 2.3264], 15: [48.8422, 2.2933], 16: [48.8637, 2.2769],
  17: [48.8872, 2.3079], 18: [48.8925, 2.3444], 19: [48.8870, 2.3814], 20: [48.8632, 2.3988],
};

const DEPARTMENT_CENTROIDS = {
  92: [48.8924, 2.2469],
  93: [48.9356, 2.3539],
  94: [48.7904, 2.4556],
  77: [48.5333, 2.6586],
  78: [48.8014, 2.1301],
  91: [48.6317, 2.4344],
  95: [49.0347, 2.0764],
};

export function centroidForPostalCode(postalCode) {
  const cp = (postalCode ?? '').trim();
  if (cp.length < 5) return null;
  const dept = cp.slice(0, 2);
  if (dept === '75') {
    const arr = parseInt(cp.slice(3, 5), 10);
    const centroid = PARIS_ARRONDISSEMENT_CENTROIDS[arr];
    return centroid ? { lat: centroid[0], lng: centroid[1] } : null;
  }
  const centroid = DEPARTMENT_CENTROIDS[dept];
  return centroid ? { lat: centroid[0], lng: centroid[1] } : null;
}
