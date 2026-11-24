import type { PoolClient } from 'pg';

export async function seedServices(client: PoolClient, members: { maya: string; jordan: string; daniel: string }) {
  const { rows: [maya, jordan, daniel] } = await client.query<{ id: number }>(`
    INSERT INTO service_providers(owner_id,headline,about,work_mode,location) VALUES
    ($1,'Design systems and product design','I help small product teams organize UI components, make accessible choices, and document the patterns they use every day.','Both','Brooklyn, NY'),
    ($2,'Product strategy for founders','I work with founders to choose what to build next, plan early experiments, and make decisions with the evidence they have.','Remote','San Francisco, CA'),
    ($3,'Brand design and creative direction','I help early-stage teams define a visual identity, from the first brief to practical brand guidelines.','Both','Chicago, IL')
    RETURNING id`, [members.maya, members.jordan, members.daniel]);
  await client.query(`
    INSERT INTO service_offerings(provider_id,title,description,category,pricing_note) VALUES
    ($1,'Design system audit','Review your component library and receive a prioritized report with accessibility fixes and opportunities to consolidate patterns.','Design','Fixed quote after scoping'),
    ($2,'Roadmap planning session','Bring an early product roadmap and leave with a shortlist of experiments, decision criteria, and next steps.','Business consulting','One 90-minute session'),
    ($3,'Brand identity workshop','Define your audience, review visual references, and agree on a creative direction for your brand.','Design','Available for small teams'),
    ($1,'Portfolio case study review','Get practical feedback on one design case study, including the decisions it explains and the evidence it shows.','Career coaching','One 45-minute session')`,
  [maya.id, jordan.id, daniel.id]);
}
