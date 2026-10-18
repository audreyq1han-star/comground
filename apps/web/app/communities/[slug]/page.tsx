import {ReviewedCommunityPage} from '../../../components/student/ReviewedCommunityPage';
export const metadata={title:'Illustrative community'};
export default async function Page({params}:{params:Promise<{slug:string}>}){const{slug}=await params;return <ReviewedCommunityPage slug={slug}/>;}
