'use client';
import { useSearchParams } from 'next/navigation';
import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Campaign } from '../../../../packages/domain/measurement-contracts.ts';
import { api } from '../Api';

type CampaignContextValue = { campaign: Campaign | null; campaigns: Campaign[]; ready: boolean; withCampaign: (path: string) => string };
const Context = createContext<CampaignContextValue>({ campaign: null, campaigns: [], ready: false, withCampaign: path => path });
function CampaignState({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const candidate = params.get('campaign');
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [firstCampaign, setFirstCampaign] = useState<Campaign | null>(null);
  useEffect(() => {
    let active = true;
    api<{data:Campaign[]}>('/api/campaigns').then(result => { if (active) setCampaigns(result.data); }).catch(() => { if (active) setCampaigns([]); });
    return () => { active = false; };
  }, []);
  const campaign = firstCampaign ?? campaigns?.find(item => item.id === candidate && !item.paused) ?? null;
  useEffect(() => { if (campaign) setFirstCampaign(current => current ?? campaign); }, [campaign]);
  const withCampaign = useCallback((path: string) => {
    if (!campaign) return path;
    const url = new URL(path, 'http://127.0.0.1'); url.searchParams.set('campaign', campaign.id);
    return `${url.pathname}${url.search}${url.hash}`;
  }, [campaign]);
  // Navigation context only: no cookies, localStorage, sessionStorage or anonymous events.
  return <Context.Provider value={{ campaign, campaigns: campaigns ?? [], ready: campaigns !== null, withCampaign }}>{children}</Context.Provider>;
}
export function CampaignProvider({ children }: { children: ReactNode }) { return <Suspense fallback={<p className="loading-label" role="status">Opening the local app…</p>}><CampaignState>{children}</CampaignState></Suspense>; }
export function useCampaign() { return useContext(Context); }
