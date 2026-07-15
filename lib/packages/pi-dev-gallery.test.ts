import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePiPackageCatalog } from './pi-dev-gallery'

test('parses Pi catalog cards, recent packages, and pagination metadata', () => {
  const catalog = parsePiPackageCatalog(
    `<a class="packages-recent-item" href="/packages/recent-pi"><strong>recent-pi</strong><span>Fresh Pi package</span><small>8m ago</small></a>
    <div class="packages-count">51-74 / 5289</div>
    <article data-package-card="true" data-package-name="catalog-pi" data-package-types="extension skill" data-package-downloads="12345" data-package-date="1700000000000">
      <p class="packages-desc">Catalog package description</p>
      <div class="packages-meta"><span>earendil</span><span>12,345/mo</span><span>2d ago</span></div>
      <div class="packages-links"><a href="https://www.npmjs.com/package/catalog-pi">npm</a><a href="https://github.com/example/catalog-pi">repo</a><a href="https://github.com/example/catalog-pi/issues/new?template=report">report</a></div>
    </article>`,
    { page: 2 },
  )

  assert.deepEqual(catalog, {
    packages: [
      {
        id: 'pi-dev:Y2F0YWxvZy1waQ',
        name: 'catalog-pi',
        source: 'npm:catalog-pi',
        type: 'npm',
        version: 'latest',
        scope: 'global',
        author: 'earendil',
        description: 'Catalog package description',
        downloads: '12,345/mo',
        resources: { extensions: 1, skills: 1, prompts: 0, themes: 0 },
        hasExtensions: true,
        status: 'installed',
        updatedAt: '2023-11-14T22:13:20.000Z',
        publishedAt: '2d ago',
        npmUrl: 'https://www.npmjs.com/package/catalog-pi',
        repoUrl: 'https://github.com/example/catalog-pi',
        reportUrl: 'https://github.com/example/catalog-pi/issues/new?template=report',
      },
    ],
    recentlyPublished: [
      {
        id: 'pi-dev:cmVjZW50LXBp',
        name: 'recent-pi',
        source: 'npm:recent-pi',
        type: 'npm',
        version: 'latest',
        scope: 'global',
        author: '',
        description: 'Fresh Pi package',
        downloads: '',
        resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
        hasExtensions: false,
        status: 'installed',
        updatedAt: catalog.recentlyPublished[0].updatedAt,
        publishedAt: '8m ago',
      },
    ],
    page: 2,
    total: 5289,
    totalPages: 106,
    start: 51,
    end: 74,
  })
})
