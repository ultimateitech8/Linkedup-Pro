import type { PoolClient } from 'pg';

export async function seedLearning(client: PoolClient, instructorId: string) {
  const samples = [
    {
      title: 'Write a case study that shows your thinking', category: 'Business', level: 'Beginner', skills: ['Product design', 'Communication'],
      description: 'Build a portfolio story around a decision, the evidence behind it, and what changed after you shipped.',
      lessons: [
        { title: 'Choose the decision to explain', minutes: 7, video: '',
          notes: 'Start with one product decision you can explain clearly. Write down the options you had, the trade-off you faced, and the evidence you used to choose. Lead the story with what was at stake for the people using the product.',
          exercise: 'Pick one project and write three sentences: the situation, the decision, and the evidence.',
          quiz: { prompt: 'Which opening gives the reader an outcome and a decision to follow?',
            choices: ['I used four design tools.', 'We shortened onboarding after usability sessions exposed an unclear first step.', 'Our team delivered several screens.'],
            answer: 1 } },
        { title: 'Show what changed', minutes: 8, video: '', quiz: null,
          notes: 'Compare the state before the change with the state after it. Use a measurement if you have one. Observed behaviors or feedback can also provide evidence. State what you would measure next.',
          exercise: 'Add a before-and-after observation to your story, then have a colleague read it without extra context.' }
      ]
    },
    {
      title: 'Give design feedback people can use', category: 'Soft skills', level: 'Beginner', skills: ['Communication', 'Team leadership'],
      description: 'Run a focused critique and leave the team with an actionable next step.',
      lessons: [
        { title: 'Agree on the question', minutes: 6, video: '', quiz: null,
          notes: 'Ask the presenter which decision is still open and which constraints the team is working within. Invite participants to give feedback on that specific decision.',
          exercise: 'Rewrite a vague request for feedback as a question about a specific decision.' },
        { title: 'Turn observations into suggestions', minutes: 9, video: '',
          notes: 'Describe what you noticed and how it changes the experience. Offer one testable suggestion and give the presenter time to respond.',
          exercise: 'Turn “this screen is confusing” into an observation with a suggested next step.',
          quiz: { prompt: 'Which feedback gives the presenter a specific action to try?',
            choices: ['Test moving the due date next to the task title and see if people notice it sooner.', 'It doesn’t feel right.', 'Make it cleaner.'], answer: 0 } }
      ]
    },
    {
      title: 'Get started with Git', category: 'Technical', level: 'Beginner', skills: ['Git', 'Version control'],
      description: 'Learn how a local repository records changes and practice making your first commit.',
      lessons: [
        { title: 'Understand version control', minutes: 10, video: 'https://www.youtube.com/watch?v=r8jQ9hVA2qs', quiz: null,
          notes: 'Featured video by GitHub. A repository records project changes over time. Each commit captures a set of changes and an explanation you can use to understand the project later.',
          exercise: 'Choose a small directory of practice files and list three changes you would record in separate commits.' },
        { title: 'Record a change', minutes: 10, video: '',
          notes: 'Run git status to see your changes. Use git add to stage the file you want to include, then git commit to record the staged changes with a message that explains what you changed.',
          exercise: 'In a practice repository, add a README and make a commit with a message that describes the change.',
          quiz: { prompt: 'Which command records the changes you staged in the repository?',
            choices: ['git status', 'git log', 'git commit'], answer: 2 } }
      ]
    }
  ];
  const courseIds: number[] = [];
  for (const course of samples) {
    const { rows: [saved] } = await client.query<{ id: number }>(`INSERT INTO learning_courses
      (instructor_id,title,description,category,level,skills,lessons,published_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,
    [instructorId, course.title, course.description, course.category, course.level, course.skills, JSON.stringify(course.lessons)]);
    courseIds.push(saved.id);
  }
  const { rows: [path] } = await client.query<{ id: number }>(`INSERT INTO learning_paths(title,description)
    VALUES('Communicate your design decisions','Develop a clear case study, then practice giving feedback in a design review.') RETURNING id`);
  await client.query('INSERT INTO learning_path_courses(path_id,position,course_id) VALUES($1,1,$2),($1,2,$3)',
    [path.id, courseIds[0], courseIds[1]]);
}
