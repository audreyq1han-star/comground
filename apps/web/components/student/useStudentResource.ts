'use client';
import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '../Api';
import { useStudent } from './StudentSession';

type ResourceState<T> = { data: T | null; loading: boolean; refreshing: boolean; error: string; refreshError: string };
export function useStudentResource<T>(url: string, method = 'GET') {
  const { request, readRevision } = useStudent();
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: true, refreshing: false, error: '', refreshError: '' });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  const setData = useCallback((data: T | null) => setState(current => ({ ...current, data })), []);
  useEffect(() => {
    let active = true;
    // Revalidation keeps forms mounted, so unchanged server data cannot discard
    // a student's unsaved choices. Initial reads still show the loading state.
    setState(current => ({ ...current, loading: current.data === null, refreshing: current.data !== null, error: '', refreshError: '' }));
    request<T>(url, { method, ...(method === 'POST' ? { body: '{}' } : {}) })
      .then(data => { if (active) setState({ data, loading: false, refreshing: false, error: '', refreshError: '' }); })
      .catch(e => {
        if (active) setState(current => ({ ...current, loading: false, refreshing: false,
          error: current.data === null ? messageOf(e) : '', refreshError: current.data !== null ? messageOf(e) : '' }));
      });
    return () => { active = false; };
  }, [url, method, request, revision, readRevision]);
  return { ...state, reload, setData };
}
