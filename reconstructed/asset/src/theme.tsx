import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'dark' | 'light';

export const PALETTES = [
  { key: 'bravo', label: 'Bravo Blue' },
  { key: 'emerald', label: 'Emerald' },
  { key: 'violet', label: 'Violet' },
  { key: 'amber', label: 'Amber' },
  { key: 'crimson', label: 'Crimson' },
] as const;

type PaletteKey = (typeof PALETTES)[number]['key'];

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  palette: PaletteKey;
  setPalette: (p: PaletteKey) => void;
}>({ theme: 'dark', toggle: () => {}, palette: 'bravo', setPalette: () => {} });

/* storage guarded so a sandboxed iframe (no same-origin) can't crash the app */
const ls = {
  get(k: string): string | null { try { return ls.get(k); } catch { return null; } },
  set(k: string, v: string) { try { ls.set(k, v); } catch { /* sandboxed */ } },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (ls.get('bravo-theme') as Theme) || 'dark',
  );
  const [palette, setPalette] = useState<PaletteKey>(
    () => (ls.get('bravo-palette') as PaletteKey) || 'bravo',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    ls.set('bravo-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    ls.set('bravo-palette', palette);
  }, [palette]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
        palette,
        setPalette,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
