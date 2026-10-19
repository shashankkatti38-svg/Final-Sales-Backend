export interface RescueItem {
  id: string;
  leadId?: string;
  leadName?: string;
  type: 'neglected_quote' | 'overdue_task' | 'stalled_hot_lead' | 'aging_invoice';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  reason: string;
  suggestedAction: string;
  actionLink: string;
  amount?: number;
  dueAt?: string;
}

export function computeSalesRescue(params: {
  leads: any[];
  documents?: any[];
  tasks?: any[];
  activities?: any[];
}): RescueItem[] {
  const { leads = [], documents = [], tasks = [], activities = [] } = params;
  const now = Date.now();
  const rescueItems: RescueItem[] = [];

  // 1. Overdue follow-ups
  const overdueTasks = tasks.filter((t) => !t.completed && new Date(t.due_at).getTime() < now);
  for (const t of overdueTasks) {
    const lead = leads.find((l) => l.id === t.lead_id);
    const hoursOverdue = Math.round((now - new Date(t.due_at).getTime()) / (1000 * 60 * 60));
    rescueItems.push({
      id: `task-${t.id}`,
      leadId: t.lead_id,
      leadName: lead?.name || 'Customer',
      type: 'overdue_task',
      severity: hoursOverdue > 24 ? 'critical' : 'warning',
      title: `Overdue Task: ${t.title}`,
      reason: hoursOverdue > 24 ? `${Math.floor(hoursOverdue / 24)}d overdue` : `${hoursOverdue}h overdue`,
      suggestedAction: lead?.phone ? 'Call Lead Immediately' : 'Open Task & Complete',
      actionLink: lead?.id ? `/leads/${lead.id}` : '/tasks',
      dueAt: t.due_at,
    });
  }

  // 2. Neglected quotations (>3 days without acceptance)
  const neglectedQuotes = documents.filter(
    (d) => d.type === 'Quotation' && d.status === 'Sent' && now - new Date(d.created_at).getTime() > 3 * 86400000
  );
  for (const q of neglectedQuotes) {
    const lead = leads.find((l) => l.id === q.lead_id);
    const daysOld = Math.floor((now - new Date(q.created_at).getTime()) / 86400000);
    rescueItems.push({
      id: `quote-${q.id}`,
      leadId: q.lead_id,
      leadName: lead?.name || 'Customer',
      type: 'neglected_quote',
      severity: daysOld > 7 ? 'critical' : 'warning',
      title: `Stalled Quote ${q.number || ''}`,
      reason: `Sent ${daysOld} days ago without conversion`,
      suggestedAction: 'Send Reminder & Offer Discount',
      actionLink: q.lead_id ? `/leads/${q.lead_id}` : '/quotations',
      amount: q.total,
    });
  }

  // 3. Stalled Hot leads without activity in >48h
  const hotLeads = leads.filter((l) => l.label === 'Hot' && l.status !== 'Delivered' && l.status !== 'Lost');
  for (const hl of hotLeads) {
    const leadActivities = activities.filter((a) => a.lead_id === hl.id);
    const lastActivityTime = leadActivities.length
      ? Math.max(...leadActivities.map((a) => new Date(a.occurred_at || a.created_at).getTime()))
      : new Date(hl.created_at).getTime();
    const hoursIdle = Math.round((now - lastActivityTime) / (1000 * 60 * 60));

    if (hoursIdle >= 48) {
      rescueItems.push({
        id: `hot-lead-${hl.id}`,
        leadId: hl.id,
        leadName: hl.name,
        type: 'stalled_hot_lead',
        severity: hoursIdle > 96 ? 'critical' : 'warning',
        title: `Hot Lead Inactive: ${hl.name}`,
        reason: `No touchpoint for ${Math.floor(hoursIdle / 24)} days`,
        suggestedAction: 'Place Outbound Call',
        actionLink: `/leads/${hl.id}`,
        amount: hl.value ? Number(hl.value) : undefined,
      });
    }
  }

  return rescueItems.sort((a, b) => {
    const weight = { critical: 0, warning: 1, info: 2 };
    return weight[a.severity] - weight[b.severity];
  });
}
