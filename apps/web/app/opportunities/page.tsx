import {Suspense} from 'react';
import {Catalogue} from '../../components/Catalogue';
export const metadata={title:'Explore opportunities'};
export default function OpportunitiesPage(){return <Suspense fallback={<div className="page-shell" role="status">Loading catalogue filters…</div>}><Catalogue/></Suspense>;}
