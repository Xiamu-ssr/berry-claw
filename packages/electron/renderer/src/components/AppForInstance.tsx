import App from '../App';

/**
 * Thin wrapper so that `<AppForInstance key={activeId}/>` gives us a clean
 * remount when the user flips instances. The `instanceId` prop is carried
 * here mostly for clarity + future context-injection (if the rest of the app
 * ever needs to read it synchronously without going through the store).
 */
export function AppForInstance({ instanceId: _instanceId }: { instanceId: string }) {
  return <App />;
}
