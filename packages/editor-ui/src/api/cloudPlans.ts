import type { Cloud, IRestApiContext, InstanceUsage, LeadEnrichmentTemplates } from '@/Interface';
import { get, post } from '@/utils/apiUtils';

export async function getCurrentPlan(context: IRestApiContext): Promise<Cloud.PlanData> {
	return get(context.baseUrl, '/admin/cloud-plan');
}

export async function getCurrentUsage(context: IRestApiContext): Promise<InstanceUsage> {
	return get(context.baseUrl, '/cloud/limits');
}

export async function getCloudUserInfo(context: IRestApiContext): Promise<Cloud.UserAccount> {
	return get(context.baseUrl, '/cloud/proxy/user/me');
}

export async function confirmEmail(context: IRestApiContext): Promise<Cloud.UserAccount> {
	return post(context.baseUrl, '/cloud/proxy/user/resend-confirmation-email');
}

export async function getAdminPanelLoginCode(context: IRestApiContext): Promise<{ code: string }> {
	return get(context.baseUrl, '/cloud/proxy/login/code');
}

export async function getLeadEnrichmentTemplates(
	context: IRestApiContext,
): Promise<LeadEnrichmentTemplates> {
	return get(context.baseUrl, '/cloud/proxy/templates');
}
