/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export function useDarkMode() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const local = localStorage.getItem('theme');
      if (local) return local;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleDarkMode = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return { isDark: theme === 'dark', toggleDarkMode };
}
