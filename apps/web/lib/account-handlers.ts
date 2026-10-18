import { EMPTY_ACCOUNT_SESSION } from '../../../packages/domain/identity-contracts.ts';
import { accounts } from './account-runtime.ts';
import { accountSession, accountSessionToken, clearAccountCookie, createAccountCookie } from './account-auth.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { RepositoryError } from './errors.ts';

type Action=(request:Request)=>Response|Promise<Response>;
function guarded(action:Action):Action { return async request=>{try{getRuntimeConfig();assertLoopback(request);if(new URL(request.url).search)throw new RepositoryError('INVALID_QUERY',400,'Account routes do not accept query parameters.');return await action(request);}catch(error){return apiError(error);}}; }
export const registerAccount=guarded(async request=>{assertSameOrigin(request);return jsonResponse(await accounts().register(await readJson(request)),202);});
export const getAccountSession=guarded(request=>{const state=accountSession(request);return jsonResponse(state,200,state.authenticated?undefined:{'set-cookie':clearAccountCookie()});});
export const loginAccount=guarded(async request=>{assertSameOrigin(request);const result=await accounts().login(await readJson(request));return jsonResponse(result.state,200,{'set-cookie':createAccountCookie(result.token)});});
export const logoutAccount=guarded(request=>{assertSameOrigin(request);accounts().logout(accountSessionToken(request));return jsonResponse(EMPTY_ACCOUNT_SESSION,200,{'set-cookie':clearAccountCookie()});});
export const requestAccountVerification=guarded(async request=>{assertSameOrigin(request);return jsonResponse(await accounts().requestVerification(await readJson(request)),202);});
export const confirmAccountVerification=guarded(async request=>{assertSameOrigin(request);const result=await accounts().verifyEmail(await readJson(request));return jsonResponse(result,200,{'set-cookie':clearAccountCookie()});});
export const requestAccountRecovery=guarded(async request=>{assertSameOrigin(request);return jsonResponse(await accounts().requestRecovery(await readJson(request)),202);});
export const confirmAccountRecovery=guarded(async request=>{assertSameOrigin(request);const result=await accounts().resetPassword(await readJson(request));return jsonResponse(result,200,{'set-cookie':clearAccountCookie()});});
export const reauthenticateAccount=guarded(async request=>{assertSameOrigin(request);const result=await accounts().reauthenticate(accountSessionToken(request),await readJson(request));return jsonResponse(result.state,200,{'set-cookie':createAccountCookie(result.token)});});
export const changeAccountPassword=guarded(async request=>{assertSameOrigin(request);const result=await accounts().changePassword(accountSessionToken(request),await readJson(request));return jsonResponse(result.state,200,{'set-cookie':createAccountCookie(result.token)});});
export const listAccountSessions=guarded(request=>jsonResponse({data:accounts().listSessions(accountSessionToken(request))}));
export const exportAccountData=guarded(request=>jsonResponse(accounts().exportData(accountSessionToken(request))));
export const revokeAllAccountSessions=guarded(request=>{assertSameOrigin(request);accounts().revokeSessions(accountSessionToken(request),null);return jsonResponse(EMPTY_ACCOUNT_SESSION,200,{'set-cookie':clearAccountCookie()});});
export function revokeAccountSession(request:Request,id:string) {return guarded(req=>{assertSameOrigin(req);const clear=accounts().revokeSessions(accountSessionToken(req),id);return jsonResponse({data:null},200,clear?{'set-cookie':clearAccountCookie()}:undefined);})(request);}
export const deleteAccountProfile=guarded(async request=>{assertSameOrigin(request);const value=objectInput(await readJson(request),['confirmation']);if(value.confirmation!=='DELETE')throw new RepositoryError('CONFIRMATION_REQUIRED',422,'Confirm DELETE to permanently remove this account and its private data.');accounts().deleteAccount(accountSessionToken(request));return jsonResponse(EMPTY_ACCOUNT_SESSION,200,{'set-cookie':clearAccountCookie()});});
