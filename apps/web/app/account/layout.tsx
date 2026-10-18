import type { ReactNode } from 'react';
import { AccountAccess } from '../../components/account/AccountCommon';
import './account.css';
export const metadata = {title:'Account'};
export default function Layout({children}: {children:ReactNode}) { return <AccountAccess>{children}</AccountAccess>; }
