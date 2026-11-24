'use client';

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { useApiResource } from './api-resource';
import { AccountSearch, LeadSearch, SalesLoadError } from './sales-search-view';
import { SalesLists, SalesPipeline } from './sales-workspace';
import type { SalesWorkspace } from './sales-data';
import { FilterTabs } from './views';

const tabs = ['Leads', 'Accounts', 'Pipeline', 'Lists'] as const;
type Tab = typeof tabs[number];
type SalesRoute = { tab: Tab; listId?: number; pipeline?: 'accounts' | 'due' };

function readSalesRoute(): SalesRoute {
  const params = new URLSearchParams(window.location.hash.split('?')[1]);
  const tab = tabs.find((item) => item.toLowerCase() === params.get('tab')) ?? 'Leads';
  const list = Number(params.get('list'));
  const view = params.get('view');
  return { tab, listId: Number.isInteger(list) && list > 0 ? list : undefined,
    pipeline: view === 'accounts' || view === 'due' ? view : undefined };
}

export function SalesView({ showPerson, message, revision }: {
  showPerson: (id: string) => void; message: (id: string) => void; revision?: number;
}) {
  const [route, setRoute] = useState<SalesRoute>();
  useEffect(() => {
    const change = () => {
      if (window.location.hash.split('?')[0] !== '#sales') return;
      setRoute(readSalesRoute());
      window.scrollTo({ top: 0 });
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const workspaceTab = route?.tab === 'Pipeline' || route?.tab === 'Lists';
  const { snapshot, refresh } = useApiResource<SalesWorkspace>(workspaceTab ? 'sales/workspace' : null, revision);

  return <div className="sales">
    <header className="sales-banner"><div><h1>Sales</h1><p>Find leads, research companies, and manage your follow-ups.</p></div>
      <Target size={89} strokeWidth={1.15} aria-hidden="true" /></header>
    <FilterTabs values={[...tabs]} current={route?.tab ?? 'Leads'} change={(value) => {
      window.location.hash = value === 'Leads' ? 'sales' : `sales?tab=${value.toLowerCase()}`;
    }} />
    {route?.tab === 'Leads' && <LeadSearch showPerson={showPerson} changed={refresh} />}
    {route?.tab === 'Accounts' && <AccountSearch changed={refresh} />}
    {workspaceTab && <>
      {!snapshot && <p className="muted" role="status">Loading your sales workspace…</p>}
      {snapshot && 'error' in snapshot && <SalesLoadError message={snapshot.error} retry={refresh} />}
      {snapshot && 'data' in snapshot && (route.tab === 'Pipeline'
        ? <SalesPipeline key={route.pipeline ?? 'leads'} workspace={snapshot.data} refresh={refresh}
          initial={route.pipeline} showPerson={showPerson} message={message} />
        : <SalesLists workspace={snapshot.data} selectedId={route.listId} showPerson={showPerson} refresh={refresh} />)}
    </>}
  </div>;
}
