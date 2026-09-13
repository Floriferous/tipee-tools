import { handlers } from './handlers.ts';
import { setupServer } from 'msw/node';

export const server = setupServer(...handlers);
