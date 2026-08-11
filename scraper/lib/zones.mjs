// Paris + grande couronne, comme décidé avec l'utilisateur.
// "location_department" vient tel quel du dataset OpenAgenda (nom, pas code INSEE).
export const DEPARTMENTS_BY_ZONE = {
  paris: ['Paris'],
  petite_couronne: ['Hauts-de-Seine', 'Seine-Saint-Denis', 'Val-de-Marne'],
  grande_couronne: ['Seine-et-Marne', 'Yvelines', 'Essonne', "Val-d'Oise"],
};

export const ALL_DEPARTMENTS = Object.values(DEPARTMENTS_BY_ZONE).flat();

const DEPARTMENT_TO_ZONE = new Map();
for (const [zone, departments] of Object.entries(DEPARTMENTS_BY_ZONE)) {
  for (const d of departments) DEPARTMENT_TO_ZONE.set(d, zone);
}

export function zoneForDepartment(department) {
  return DEPARTMENT_TO_ZONE.get(department) ?? null;
}
