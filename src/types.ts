export type Category = 'theatre' | 'standup' | 'concert' | 'ephemere' | 'evenement';
export type Zone = 'paris' | 'petite_couronne' | 'grande_couronne';

export interface EventItem {
  id: string;
  title: string;
  category: Category;
  venue: string;
  address?: string;
  zone: Zone;
  lat: number;
  lng: number;
  price: number;
  priceLabel: string;
  dateStart: string;
  dateEnd?: string;
  rating?: number;
  reviewsCount?: number;
  reviewsSource?: string;
  description?: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  fetchedAt: string;
  isNew: boolean;
  verified: boolean;
  verifiedVia?: string;
}

export interface EventsFile {
  generatedAt: string;
  sources: string[];
  events: EventItem[];
}

export const CATEGORY_LABELS: Record<Category, string> = {
  theatre: 'Théâtre',
  standup: 'Stand-up',
  concert: 'Concert',
  ephemere: 'Pop-up store',
  evenement: 'Événement',
};
