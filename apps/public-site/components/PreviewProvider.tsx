'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ActivityCategory, ActivityFormat, ActivityId, ExampleAge } from './preview-model';

type PreviewState = {
  age: ExampleAge;
  setAge: (age: ExampleAge) => void;
  category: ActivityCategory;
  setCategory: (category: ActivityCategory) => void;
  format: ActivityFormat;
  setFormat: (format: ActivityFormat) => void;
  shortlist: ActivityId[];
  add: (id: ActivityId) => void;
  remove: (id: ActivityId) => void;
};

const PreviewContext = createContext<PreviewState | null>(null);

/** Fictional choices only. State is deliberately never written to browser storage or sent anywhere. */
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [age, setAge] = useState<ExampleAge>('16–17');
  const [category, setCategory] = useState<ActivityCategory>('All activities');
  const [format, setFormat] = useState<ActivityFormat>('Any format');
  const [shortlist, setShortlist] = useState<ActivityId[]>([]);
  return <PreviewContext.Provider value={{
    age, setAge, category, setCategory, format, setFormat, shortlist,
    add: id => setShortlist(current => current.includes(id) ? current : [...current, id]),
    remove: id => setShortlist(current => current.filter(item => item !== id)),
  }}>{children}</PreviewContext.Provider>;
}

export function usePreview() {
  const value = useContext(PreviewContext);
  if (!value) throw new Error('Preview state requires PreviewProvider.');
  return value;
}
