import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { EventItem, Category } from './types';

const CATEGORY_COLOR_VAR: Record<Category, string> = {
  theatre: '--cat-theatre',
  standup: '--cat-standup',
  concert: '--cat-concert',
  ephemere: '--cat-popup',
  evenement: '--cat-evenement',
};

function pinIcon(category: Category): L.DivIcon {
  return L.divIcon({
    className: 'map-pin',
    html: `<span style="background:var(${CATEGORY_COLOR_VAR[category]})"></span>`,
    iconSize: [14, 14],
  });
}

const PARIS_CENTER: L.LatLngExpression = [48.8566, 2.3522];

export interface MapController {
  setEvents(events: EventItem[]): void;
  invalidateSize(): void;
}

export function setupMap(containerId: string, onSelect: (id: string) => void): MapController {
  const map = L.map(containerId, { zoomControl: true }).setView(PARIS_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  const cluster = L.markerClusterGroup({ maxClusterRadius: 50 });
  map.addLayer(cluster);

  return {
    setEvents(events: EventItem[]) {
      cluster.clearLayers();
      const markers = events.map((e) => {
        const marker = L.marker([e.lat, e.lng], { icon: pinIcon(e.category) });
        marker.bindTooltip(e.title, { direction: 'top', offset: [0, -8] });
        marker.on('click', () => onSelect(e.id));
        return marker;
      });
      cluster.addLayers(markers);
      if (markers.length > 0) {
        map.fitBounds(cluster.getBounds(), { padding: [24, 24], maxZoom: 15 });
      }
    },
    invalidateSize() {
      map.invalidateSize();
    },
  };
}
