'use client';

import { Icon } from '../icons';
import { Link } from '../parts';
import { useTipSeen } from '../../client/tip-store';
import { useRuntime } from '../state';

export function CreateView() {
  const { runtime } = useRuntime();
  const opened = useTipSeen('storyboard-opened');
  return (
    <div className="sv-wrap create-wrap">
      <h1 className="h1" tabIndex={-1}>
        Create
      </h1>
      <p className="lede muted" style={{ marginTop: 4, maxWidth: '60ch' }}>
        Two ways to put a deck together.
      </p>
      <div className="create-cards">
        <button
          type="button"
          className="card create-card create-card-ai"
          onClick={() => {
            opened.dismiss();
            runtime.navigate({ view: 'story' });
          }}
        >
          <Icon name="sparkle" className="ic-big" />
          <h2 className="h2">Build with AI</h2>
          <p className="meta">Describe the client and SlideVault pulls a story from your slides.</p>
          <span className="create-go">
            Open the Storyboard
            <Icon name="right" className="ic-sm" />
          </span>
        </button>
        <div className="card create-card create-card-planned">
          <Icon name="plus" className="ic-big" />
          <h2 className="h2">Build it yourself</h2>
          <p className="meta">
            For now, build it from{' '}
            <Link to={{ view: 'pages' }} className="create-home">
              Home
            </Link>
            .
          </p>
          <span className="badge" style={{ alignSelf: 'flex-start' }}>
            Planned
          </span>
        </div>
      </div>
    </div>
  );
}
