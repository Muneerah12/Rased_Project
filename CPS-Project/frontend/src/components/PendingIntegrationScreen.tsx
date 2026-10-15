import { Notice, PageHeader } from './Primitives'

export function PendingIntegrationScreen({ title, message }: { title: string; message: string }) {
  return <>
    <PageHeader title={title} />
    <section className="panel integration-pending" aria-label={`${title} integration status`}>
      <h2>Integration pending</h2>
      <Notice>{message}</Notice>
    </section>
  </>
}
