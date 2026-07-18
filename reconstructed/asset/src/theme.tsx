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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('bravo-theme') as Theme) || 'dark',
  );
  const [palette, setPalette] = useState<PaletteKey>(
    () => (localStorage.getItem('bravo-palette') as PaletteKey) || 'bravo',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bravo-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem('bravo-palette', palette);
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
