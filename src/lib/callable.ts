import app, { FUNCTIONS_REGION } from '../../lib/firebase';

// firebase/functions is loaded on first call (it is only needed for emails and
// role admin), keeping it out of the main bundle.
export const callFunction = async <Req = unknown, Res = unknown>(name: string, data?: Req): Promise<Res> => {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const result = await httpsCallable<Req, Res>(getFunctions(app, FUNCTIONS_REGION), name)(data);
  return result.data;
};
