import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Img } from './Img';

describe('<Img />', () => {
  it('renders an <img> element with the supplied dimensions', () => {
    render(<Img src="/photo.jpg" alt="A student" width={64} height={48} />);
    const el = screen.getByRole('img', { name: 'A student' });
    expect(el.tagName).toBe('IMG');
    expect(el.getAttribute('width')).toBe('64');
    expect(el.getAttribute('height')).toBe('48');
    expect(el.getAttribute('src')).toBe('/photo.jpg');
  });

  it('defaults to loading="lazy" and decoding="async"', () => {
    render(<Img src="/photo.jpg" alt="" width={64} height={48} />);
    const el = screen.getByRole('presentation', { hidden: true });
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('decoding')).toBe('async');
    // No priority by default ⇒ no fetchpriority attribute set.
    expect(el.hasAttribute('fetchpriority')).toBe(false);
  });

  it('switches to eager loading and high fetch priority when priority is set', () => {
    render(<Img src="/hero.jpg" alt="Hero" width={1200} height={600} priority />);
    const el = screen.getByRole('img', { name: 'Hero' });
    expect(el.getAttribute('loading')).toBe('eager');
    expect(el.getAttribute('fetchpriority')).toBe('high');
  });

  it('lets consumers override loading and decoding', () => {
    render(
      <Img
        src="/photo.jpg"
        alt="Override"
        width={64}
        height={48}
        loading="eager"
        decoding="sync"
      />,
    );
    const el = screen.getByRole('img', { name: 'Override' });
    expect(el.getAttribute('loading')).toBe('eager');
    expect(el.getAttribute('decoding')).toBe('sync');
  });

  it('forwards arbitrary <img> attributes (className, srcSet, etc.)', () => {
    render(
      <Img
        src="/a.jpg"
        srcSet="/a.jpg 1x, /a@2x.jpg 2x"
        sizes="64px"
        className="rounded"
        alt="With srcSet"
        width={64}
        height={64}
      />,
    );
    const el = screen.getByRole('img', { name: 'With srcSet' });
    expect(el.getAttribute('srcset')).toBe('/a.jpg 1x, /a@2x.jpg 2x');
    expect(el.getAttribute('sizes')).toBe('64px');
    expect(el).toHaveClass('rounded');
  });

  it('falls back to alt="" when alt is omitted (decorative image)', () => {
    render(<Img src="/spacer.png" width={1} height={1} />);
    // empty alt ⇒ presentational role
    const el = screen.getByRole('presentation', { hidden: true });
    expect(el.getAttribute('alt')).toBe('');
  });

  it('forwards refs to the underlying <img> element', () => {
    const refs: HTMLImageElement[] = [];
    render(
      <Img
        ref={(node) => {
          if (node) refs.push(node);
        }}
        src="/r.jpg"
        alt="Ref"
        width={10}
        height={10}
      />,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.tagName).toBe('IMG');
  });
});
