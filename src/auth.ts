import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Category, Zone } from './types';

export interface Preferences {
  favoriteCategories: Category[];
  homeZone: Zone | null;
  favoriteEventIds: string[];
  ageRange: string | null;
  humorTypes: string[];
  showTypes: string[];
  kycCompleted: boolean;
}

export const EMPTY_PREFS: Preferences = {
  favoriteCategories: [],
  homeZone: null,
  favoriteEventIds: [],
  ageRange: null,
  humorTypes: [],
  showTypes: [],
  kycCompleted: false,
};

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isAuthConfigured = Boolean(url && anonKey);

const client: SupabaseClient | null = isAuthConfigured ? createClient(url, anonKey) : null;

export async function getSession(): Promise<Session | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

export function onAuthStateChange(cb: (session: Session | null) => void): () => void {
  if (!client) return () => {};
  const { data } = client.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signUp(email: string, password: string): Promise<string | null> {
  if (!client) return "Comptes non configurés pour l'instant.";
  const { error } = await client.auth.signUp({ email, password });
  return error?.message ?? null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!client) return "Comptes non configurés pour l'instant.";
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error?.message ?? null;
}

export async function signInWithGoogle(): Promise<string | null> {
  if (!client) return "Comptes non configurés pour l'instant.";
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  return error?.message ?? null;
}

export async function signOut(): Promise<void> {
  await client?.auth.signOut();
}

export async function loadPreferences(userId: string): Promise<Preferences> {
  if (!client) return EMPTY_PREFS;
  const { data, error } = await client
    .from('preferences')
    .select('favorite_categories, home_zone, favorite_event_ids, age_range, humor_types, show_types, kyc_completed')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return EMPTY_PREFS;
  return {
    favoriteCategories: (data.favorite_categories ?? []) as Category[],
    homeZone: (data.home_zone ?? null) as Zone | null,
    favoriteEventIds: (data.favorite_event_ids ?? []) as string[],
    ageRange: (data.age_range ?? null) as string | null,
    humorTypes: (data.humor_types ?? []) as string[],
    showTypes: (data.show_types ?? []) as string[],
    kycCompleted: Boolean(data.kyc_completed),
  };
}

export async function savePreferences(userId: string, prefs: Preferences): Promise<string | null> {
  if (!client) return "Comptes non configurés pour l'instant.";
  const { error } = await client.from('preferences').upsert({
    user_id: userId,
    favorite_categories: prefs.favoriteCategories,
    home_zone: prefs.homeZone,
    favorite_event_ids: prefs.favoriteEventIds,
    age_range: prefs.ageRange,
    humor_types: prefs.humorTypes,
    show_types: prefs.showTypes,
    kyc_completed: prefs.kycCompleted,
    updated_at: new Date().toISOString(),
  });
  return error?.message ?? null;
}
