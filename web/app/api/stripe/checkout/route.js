import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export async function POST(request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email, display_name')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    // Create Stripe customer if not exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email || user.email,
        name: profile?.display_name || user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: process.env.STRIPE_PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/profile?upgraded=true`,
      cancel_url: `${siteUrl}/profile?cancelled=true`,
      metadata: { supabase_user_id: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
