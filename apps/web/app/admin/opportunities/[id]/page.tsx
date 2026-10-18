import { CatalogueDetail } from '../../../../components/admin/CatalogueDetail';
export const metadata={title:'Opportunity record · Operator'};
export default async function RecordPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <CatalogueDetail id={id}/>;}
