import { auth, db, demoEmail, demoPassword } from './database.js';
import { seedLearning } from './learning-seed.js';
import { seedServices } from './service-seed.js';

const people = [
  { name: 'Alex Morgan', email: demoEmail, image: 'alex', headline: 'Product Designer', location: 'Brooklyn, NY', skills: ['Product design', 'User research', 'Prototyping'], about: 'I design thoughtful digital products and love making complicated things easier to use.' },
  { name: 'Maya Chen', email: 'maya@example.test', image: 'maya', headline: 'Design Lead at Studio North', location: 'Brooklyn, NY', skills: ['Design systems', 'Team leadership'], about: 'Building design teams and better tools at Studio North.' },
  { name: 'Jordan Lee', email: 'jordan@example.test', image: 'jordan', headline: 'Founder at Forma', location: 'San Francisco, CA', skills: ['Product strategy', 'Hiring'], about: 'Building a better way for teams to plan their work.' },
  { name: 'Priya Patel', email: 'priya@example.test', image: 'priya', headline: 'UX Researcher at Echo', location: 'New York, NY', skills: ['Interviews', 'Usability testing'], about: 'Researching the little things that make a product feel right.' },
  { name: 'Daniel Brooks', email: 'daniel@example.test', image: 'daniel', headline: 'Creative Director at Fieldwork', location: 'Chicago, IL', skills: ['Creative direction', 'Brand design'], about: 'Helping teams tell clear, memorable stories about their work.' }
];

export async function seed() {
  const ids: string[] = [];
  for (const person of people) {
    const existing = await db.query('SELECT id FROM "user" WHERE email = $1', [person.email]);
    const id = existing.rows[0]?.id ?? (await auth.api.signUpEmail({
      body: { name: person.name, email: person.email, password: demoPassword, image: `/images/${person.image}.jpg` }
    })).user.id;
    await db.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1 AND NOT "emailVerified"', [id]);
    await db.query(
      'INSERT INTO profiles(user_id, headline, location, about, skills) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [id, person.headline, person.location, person.about, person.skills]
    );
    ids.push(id);
  }
  const [alex, maya, jordan, priya, daniel] = ids;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(77124832)');
    await client.query('CREATE TABLE IF NOT EXISTS demo_seed (id integer PRIMARY KEY)');
    const marker = await client.query('INSERT INTO demo_seed VALUES (1) ON CONFLICT DO NOTHING RETURNING id');
    if (marker.rowCount) {
      await client.query('INSERT INTO connections(sender, recipient, accepted) VALUES ($1,$2,true), ($1,$3,true)', [alex, maya, jordan]);
      await client.query(
        `INSERT INTO projects(owner_id,title,contribution,verifier_id,verified_at) VALUES
         ($1,'Field Notes research library','I designed the library and led usability testing with five researchers.',$2,now())`,
        [alex, maya]
      );
      const posts = await client.query(
        `INSERT INTO posts(author_id,body,image,created_at) VALUES
         ($1,$2,null,now() - interval '2 hours'), ($3,$4,$5,now() - interval '5 hours'),
         ($6,$7,null,now() - interval '1 day') RETURNING id`,
        [maya, 'The best portfolio advice I ever got: show the messy middle. The sketches, the trade-offs, the idea that didn’t work. That’s the part that tells me how you think.\n\nWhat’s something you wish you’d put in your first portfolio?', jordan,
          'We spent the last few months rethinking how small teams plan together. The biggest change came from deleting three features. Sometimes the work is in deciding what to leave out.', '/images/workspace.jpg',
          priya, 'I’m putting together a small research reading group for people who want to get better at interviewing. What’s a question you wish you’d learned to ask earlier?']
      );
      await client.query('INSERT INTO reactions(post_id, user_id) VALUES ($1,$2),($1,$3),($1,$4),($5,$2)', [posts.rows[0].id, jordan, priya, daniel, posts.rows[1].id]);
      await client.query('INSERT INTO comments(post_id,author_id,body) VALUES ($1,$2,$3)', [posts.rows[0].id, priya, 'I wish I had included how our early interviews changed the direction of the whole project.']);
      await client.query(
        `INSERT INTO jobs(owner_id,title,company,location,work_mode,employment_type,salary,description,response_date,color,created_at) VALUES
         ($1,'Senior Product Designer','Forma','United States','Remote','Full-time','$135k–$165k',
         'Help small teams plan with confidence. You’ll partner with research and engineering to improve core workflows, own the design of new features, and bring your work to life in a small cross-functional team.',
         CURRENT_DATE + 14,'violet',now() - interval '30 minutes'),
         ($2,'UX Researcher','Studio North','Brooklyn, NY','Hybrid','Full-time','$95k–$120k',
         'Lead interviews and usability studies for clients creating useful digital services. Share what you learn and turn research into practical product decisions.',
         CURRENT_DATE + 18,'peach',now() - interval '1 day'),
         ($3,'Brand Designer','Fieldwork','Chicago, IL','On-site','Contract','$75–$95/hr',
         'Help shape visual identities for small organizations. This role covers early concepts, design systems, and practical brand guidelines.',
         CURRENT_DATE + 21,'green',now() - interval '2 days')`,
        [jordan, maya, daniel]
      );
      await client.query('INSERT INTO messages(sender,recipient,body) VALUES ($1,$2,$3)', [maya, alex, 'Hey Alex! I just confirmed your contribution to Field Notes. Great work on that research library.']);
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES ($1,$2,'Profile')", [alex, 'Maya Chen confirmed your contribution to Field Notes research library.']);
    }
    const groupMarker = await client.query('INSERT INTO demo_seed VALUES (2) ON CONFLICT DO NOTHING RETURNING id');
    if (groupMarker.rowCount) {
      const { rows: [design, research] } = await client.query(
        `INSERT INTO professional_groups(owner_id,name,description,industry,visibility) VALUES
         ($1,'Product Design Exchange','For designers to trade portfolio feedback and share how they work.','Design','public'),
         ($1,'Research Roundtable','For researchers to compare interview techniques and discuss what they learned in the field.','User research','private') RETURNING id`, [maya]
      );
      await client.query(
        `INSERT INTO group_members(group_id,user_id,membership) VALUES
         ($1,$3,'active'),($1,$4,'active'),($2,$3,'active'),($2,$5,'pending'),($2,$4,'invited')`,
        [design.id, research.id, maya, alex, priya]
      );
      await client.query(
        `INSERT INTO posts(group_id,author_id,group_topic,body) VALUES
         ($1,$3,'What should a portfolio case study show?',$5),
         ($1,$4,'Share your favorite design critique format',$6),
         ($2,$3,'Planning interviews for a new research project',$7)`,
        [design.id, research.id, maya, alex,
          'I’m reviewing portfolios this month. Which part of a case study best shows how you make a design decision?',
          'We started ending critique with one question the designer wants help with. Has anyone tried a format they would recommend?',
          'I’m planning shorter interviews with more time for follow-up questions. What prompts help participants go beyond their first answer?']
      );
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Groups')",
        [alex, 'Maya Chen invited you to Research Roundtable.']);
    }
    const eventMarker = await client.query('INSERT INTO demo_seed VALUES (3) ON CONFLICT DO NOTHING RETURNING id');
    if (eventMarker.rowCount) {
      const { rows: [clinic] } = await client.query(
        `INSERT INTO professional_events(host_id,title,description,category,format,starts_at,ends_at,venue,meeting_url) VALUES
         ($1,'Portfolio review clinic','Bring one case study and get feedback on how you explain your decisions.','Webinar','online',
          now()+interval '2 days',now()+interval '2 days 1 hour',NULL,'https://example.com/'),
         ($2,'Product teams meetup','Meet people working on small product teams and compare how you plan and run experiments.','Meetup','in-person',
          now()+interval '6 days',now()+interval '6 days 90 minutes','Brooklyn, New York',NULL) RETURNING id`,
        [maya, jordan]
      );
      await client.query("INSERT INTO event_attendees(event_id,user_id,status) VALUES($1,$2,'invited')", [clinic.id, alex]);
      await client.query(
        'INSERT INTO posts(event_id,author_id,event_topic,body) VALUES($1,$2,$3,$4)',
        [clinic.id, maya, 'What would you like feedback on?', 'Share one question you want to bring to the review.']
      );
      await client.query("INSERT INTO notifications(user_id,message,category) VALUES($1,$2,'Events')",
        [alex, 'Maya Chen invited you to Portfolio review clinic.']);
    }
    const publishingMarker = await client.query('INSERT INTO demo_seed VALUES (4) ON CONFLICT DO NOTHING RETURNING id');
    if (publishingMarker.rowCount) {
      const { rows: [newsletter] } = await client.query(
        `INSERT INTO newsletters(owner_id,title,description,cadence,edition_count)
         VALUES($1,'Inside the Design Review','Notes on giving feedback, making decisions, and showing your work.','Monthly',1) RETURNING id`, [maya]
      );
      await client.query('INSERT INTO newsletter_subscriptions(newsletter_id,user_id) VALUES($1,$2)', [newsletter.id, alex]);
      const article = {
        type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A portfolio needs to show how you made a decision. The polished screen gives the reader an outcome, and a short account of what you tried gives it context.' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Start with one decision' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Show an early version, explain what you learned, and describe what changed in the next version.' }] }
        ]
      };
      await client.query(
        `INSERT INTO publication_articles(author_id,newsletter_id,edition_number,title,excerpt,body,published_at) VALUES
         ($1,$2,1,'The best part of a case study','Show how you made one decision and what changed when you tested it.',$3,now()-interval '1 day'),
         ($4,NULL,NULL,'Make your critique easier to act on','Start with the question you need answered, then show the work.',$5,now()-interval '2 days')`,
        [maya, newsletter.id, article, jordan, { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A critique works better when everyone knows what feedback the presenter is asking for.' }] },
          { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start with the question you want the room to answer.' }] }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Write down the feedback, decide what to try, then bring that decision to the next review.' }] }
        ] }]
      );
    }
    const companyMarker = await client.query('INSERT INTO demo_seed VALUES (5) ON CONFLICT DO NOTHING RETURNING id');
    if (companyMarker.rowCount) {
      const { rows: [forma, north, fieldwork] } = await client.query(
        `INSERT INTO professional_companies(owner_id,name,description,industry,size,headquarters,locations,workplace,culture) VALUES
         ($1,'Forma','We build planning tools for small teams.','Software','11–50','San Francisco, CA','{}','Remote',
          'We work in small teams, test ideas early, and write down how we make decisions.'),
         ($2,'Studio North','An independent studio working on design systems and digital products.','Design','11–50','Brooklyn, NY','{}',
          'Hybrid','We make time for weekly design reviews and take turns sharing what we have learned.'),
         ($3,'Fieldwork','A creative practice focused on brand design.','Creative services','1–10','Chicago, IL','{}','Varies by role','')
         RETURNING id`, [jordan, maya, daniel]
      );
      await client.query(`INSERT INTO company_members(company_id,user_id,role) VALUES
        ($1,$4,'admin'),($2,$5,'admin'),($3,$6,'admin')`, [forma.id, north.id, fieldwork.id, jordan, maya, daniel]);
      await client.query('INSERT INTO company_followers(company_id,user_id) VALUES($1,$2)', [forma.id, alex]);
      for (const listing of [
        { company: forma.id, owner: jordan, name: 'Forma', title: 'Senior Product Designer' },
        { company: north.id, owner: maya, name: 'Studio North', title: 'UX Researcher' },
        { company: fieldwork.id, owner: daniel, name: 'Fieldwork', title: 'Brand Designer' }
      ]) {
        await client.query(`UPDATE jobs SET company_id=$1 WHERE id=(
          SELECT id FROM jobs WHERE owner_id=$2 AND company=$3 AND title=$4 AND company_id IS NULL ORDER BY id LIMIT 1)`,
        [listing.company, listing.owner, listing.name, listing.title]);
      }
      await client.query(`INSERT INTO company_showcases(company_id,kind,title,description) VALUES
        ($1,'Product','Forma Plans','A shared workspace for planning projects and keeping a small team in sync.'),
        ($2,'Showcase','Studio North design practice','A look at how we run product and design-system projects.')`, [forma.id, north.id]);
      await client.query(`INSERT INTO posts(author_id,company_id,body,created_at) VALUES($1,$2,$3,now()-interval '8 hours')`,
        [jordan, forma.id, 'We’re growing our design team. Visit the Forma page to see our open role and learn how the team works.']);
    }
    const learningMarker = await client.query('INSERT INTO demo_seed VALUES (6) ON CONFLICT DO NOTHING RETURNING id');
    if (learningMarker.rowCount) await seedLearning(client, maya);
    const servicesMarker = await client.query('INSERT INTO demo_seed VALUES (7) ON CONFLICT DO NOTHING RETURNING id');
    if (servicesMarker.rowCount) await seedServices(client, { maya, jordan, daniel });
    const jobSkillsMarker = await client.query('INSERT INTO demo_seed VALUES (8) ON CONFLICT DO NOTHING RETURNING id');
    if (jobSkillsMarker.rowCount) await client.query(`UPDATE jobs SET required_skills=ARRAY['Product design','User research','Design systems']
      WHERE id=(SELECT id FROM jobs WHERE owner_id=$1 AND company='Forma' AND title='Senior Product Designer' ORDER BY id LIMIT 1)
        AND cardinality(required_skills)=0`, [jordan]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
