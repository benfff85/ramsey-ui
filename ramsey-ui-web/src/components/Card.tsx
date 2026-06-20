import type { ReactNode } from 'react';

export function Card({ title, children, hero, action }: {
  title?: ReactNode; children: ReactNode; hero?: boolean; action?: ReactNode;
}) {
  return (
    <section className={`card${hero ? ' card--hero' : ''}`}>
      {(title || action) && (
        <div className="card__head">
          {title ? <h2 className="card__title">{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
