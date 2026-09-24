from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tracker", "0005_foodlog_label_photo_foodlog_nutrition_source_and_more")]

    operations = [
        migrations.AddField(model_name="appsettings", name="target_weekly_gain",
                            field=models.DecimalField(decimal_places=2, default=Decimal("0.50"), max_digits=5)),
        migrations.AddField(model_name="food", name="sugar",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="food", name="added_sugar",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="foodlog", name="sugar_snapshot",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="foodlog", name="added_sugar_snapshot",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="savedmeal", name="sugar",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="savedmeal", name="added_sugar",
                            field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AddField(model_name="savedmeal", name="components", field=models.JSONField(blank=True, default=list)),
        migrations.AddField(model_name="savedmeal", name="client_id",
                            field=models.UUIDField(blank=True, null=True, unique=True)),
    ]
