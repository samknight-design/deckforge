import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export async function POST(request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const subscriptionId = session.subscription;

        if (userId && subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

          await serviceClient
            .from('profiles')
            .update({
              tier: 'pro',
              stripe_subscription_id: subscriptionId,
              subscription_ends_at: periodEnd,
            })
            .eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const { data: profile } = await serviceClient
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (profile) {
          const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
          const isActive = subscription.status === 'active' || subscription.status === 'trialing';

          await serviceClient
            .from('profiles')
            .update({
              tier: isActive ? 'pro' : 'free',
              subscription_ends_at: periodEnd,
            })
            .eq('id', profile.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const { data: profile } = await serviceClient
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (profile) {
          await serviceClient
            .from('profiles')
            .update({
              tier: 'free',
              stripe_subscription_id: null,
              subscription_ends_at: null,
            })
            .eq('id', profile.id);
        }
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
