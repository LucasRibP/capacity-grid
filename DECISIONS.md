# Decisions

## What did the spec not tell you?

- There is some prep I did before the test. I assumed that I would have to be fast and that there would be both frontend and backend work to be done, and looking at the time and the current AI landscape, I assumed it would be okay for me to use agents.
  - So I chose in advance how I would approach each stack and how to integrate them. I chose to use oapi-codegen and Orval to generate most of the data layer for both sides and to generate the mocks I would use in React (the mocks were important because, as time was short, I intended to develop the frontend and backend in parallel in multiple worktrees).
  - I also chose heavy test usage, to make sure the code came out less broken by the time I got to it. Since the agent was going to write the bulk of it, it needed a way to evaluate on its own whether the code it wrote was working.
  - I also had it write a CLAUDE.md file at the beginning with good practices and the patterns I chose to use in the project, so that the AI code would come out better.
  - The last point I had chosen during prep was to use a strong linter ruleset for both Go and JS, to make sure that the code the AI wrote would be less error-prone and start at a higher quality bar as well.
  - I chose React Query for 3 reasons.
    - I was already accustomed to the way it works, it separates data handling and UI better, and it is the most common solution for React.
    - It's the stack you use :)
    - Orval already generates everything for it, which made it easier to use in the test as well.
- I chose pessimistic saving. I would consider optimistic saving if I had more time, but as the queries were already fast enough and it would take more work to maintain, even with more time I wouldn't do it (unless there were a performance reason).
- There were a lot of weeks. If I tried to render everything, the performance was terrible, so I chose to keep 13 weeks, as it's a quarter and I imagine that most managers wouldn't look at more than a quarter at once most of the time.
- I also virtualized the list of users and the performance improved even more. I considered infinite scrolling, but I tested with a synthetic DB with 3000 people, and the full query took 200–300 ms (around 0.5 s through the API). I found that acceptable for a first version, so I postponed pagination. On the product side, I don't believe a manager would look at more than that.
- I added search, since I could not imagine navigating that page without search.

## What did you notice that looked wrong?

- The columns resized when we scrolled. I only noticed at the end and had no time to fix it.
- I don't like how the calendar filter ended up. It should only allow the user to select full weeks, so that part of the UI needed more work. Also, the forward arrow only moved the calendar one week forward, which makes no sense in a quarterly view; I would fix that in the future too.
- Search ties are sorted by name, so "Sørensen" (surname) comes before "Søren" (first name). In real life it would be a product decision, but to me it makes more sense for first names to have higher priority.

## What did the AI get wrong that you caught?

When I went to check the performance at the end, the performance of the capacity GET was a lot worse than I expected for the size of the database. I had the agent run an EXPLAIN ANALYZE to understand what was going on and found out that generate_series made Postgres estimate 1000 weeks instead of 13, which led to around 250 ms of JIT compilation on a 30 ms query. I switched to an integer series, which fixed the estimate and brought the query down to 23 ms.

## What would you do differently with a week?

- Fix the bugs I mentioned in the previous section (column resizing and improving the calendar filter).
- Improve the search by moving more of the work to precomputed columns in the database.
- I would implement infinite scrolling with gradual requests to the backend. The speed for 3000 people was okay, but for future-proofing I think it would be worth the effort.
- Improve the UI. I used shadcn/ui for speed, but it feels very AI-written; with more time I could have made a much better UI.