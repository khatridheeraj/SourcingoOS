-- Buyers should only see orders Sourcingo has confirmed. 0001 let draft
-- sales orders through the buyer portal, labelled "Order confirmed".

create or replace view portal_buyer_orders as
  select o.id, o.buyer_po_number, o.so_date, o.buyer_date, o.currency,
         case
           when o.status = 'shipped' then 'Shipped'
           when o.status <> 'locked' then 'Order confirmed'
           else coalesce((
             select case when c.name ~* 'qc|inspect|quality' then 'QC'
                         when c.name ~* 'pack' then 'Packing'
                         when c.name ~* 'dispatch|ship' then 'Ready to ship'
                         else 'Production' end
               from tna_checkpoints c join so_styles s on s.id = c.style_id
              where s.so_id = o.id and c.status <> 'completed'
              order by c.due_date nulls last, c.position limit 1), 'Ready to ship')
         end as milestone
    from sales_orders o
   where o.buyer_id = my_buyer_id() and o.status <> 'draft';

create or replace view portal_buyer_styles as
  select s.id, s.so_id, s.name, s.code, s.colour, s.qty, s.buyer_rate
    from so_styles s join sales_orders o on o.id = s.so_id
   where o.buyer_id = my_buyer_id() and o.status <> 'draft';
