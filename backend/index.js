require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const bodyParser = require('body-parser');
const Transaction = require('./models/transaction');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

// mongoDb connection
mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,  
    socketTimeoutMS: 45000,          
    connectTimeoutMS: 10000,        
    maxPoolSize: 10                 
})
    .then(() => {
        console.log('MongoDB connected successfully');
    })
    .catch(err => {
        console.error('Error connecting to MongoDB:', err);
    });

//Seeddb by fetching data from the api
app.get('/api/seed', async (req, res) => {
    try {
        const response = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');

        await Transaction.deleteMany();

        const transactionsWithMonth = response.data.map(transaction => {
            const dateOfSale = new Date(transaction.dateOfSale);
            return {
                ...transaction,
                month: dateOfSale.getMonth() + 1 
            };
        });

        await Transaction.insertMany(transactionsWithMonth);
        res.status(200).send('Database seeded successfully');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error seeding database');
    }
});


function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// api1:list transactionns with search,pagination,filter by month
app.get('/api/transactions', async (req, res) => {
    const { search = '', page = 1, perPage = 10, month } = req.query;
    const skip = (page - 1) * perPage;


    const escapedSearch = escapeRegExp(search);
    const regex = new RegExp(escapedSearch, 'i'); 

    try {
        const filter = {};

        if (!isNaN(search) && search.trim() !== '') {
            filter.price = Number(search);
        } else {
            filter.$or = [
                { title: regex },
                { description: regex },
                { category: regex },
            ];
        }

        if (month) {
            const monthNumber = parseInt(month, 10); 
            if (!isNaN(monthNumber)) {
                filter.month = monthNumber; 
            }
        }

        const transactions = await Transaction.find(filter)
            .skip(skip)
            .limit(perPage);

        const count = await Transaction.countDocuments(filter);

        res.status(200).json({ transactions, total: count });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).send('Error fetching transactions');
    }
});

// api 2: get transaction statistics
app.get('/api/transactions/stats', async (req, res) => {
    const { month } = req.query;

    if (!month) {
        return res.status(400).json({ message: 'Month is required for statistics' });
    }

    try {
        const stats = await Transaction.aggregate([
            { $match: { month: parseInt(month, 10) } }, 
            {
                $group: {
                    _id: null,
                    totalSale: { $sum: "$price" },
                    totalSoldItems: { $sum: { $cond: ["$sold", 1, 0] } },
                    totalNotSoldItems: { $sum: { $cond: ["$sold", 0, 1] } }
                }
            }
        ]);

        if (stats.length > 0) {
            res.status(200).json(stats[0]);
        } else {
            res.status(404).json({ message: 'No data found for the selected month' });
        }
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).send('Error fetching statistics');
    }
});

// api 3: get bar chart data for price ranges
app.get('/api/transactions/bar-chart', async (req, res) => {
    const { month } = req.query;

    if (!month) {
        return res.status(400).json({ message: 'Month is required for chart data' });
    }

    try {
        const priceRanges = [
            { range: "0-100", min: 0, max: 100 },
            { range: "101-200", min: 101, max: 200 },
            { range: "201-300", min: 201, max: 300 },
            { range: "301-400", min: 301, max: 400 },
            { range: "401-500", min: 401, max: 500 },
            { range: "501-600", min: 501, max: 600 },
            { range: "601-700", min: 601, max: 700 },
            { range: "701-800", min: 701, max: 800 },
            { range: "801-900", min: 801, max: 900 },
            { range: "901-above", min: 901, max: Number.MAX_SAFE_INTEGER }
        ];

        const chartData = []; 

        for (const range of priceRanges) {
            try {
                const count = await Transaction.countDocuments({
                    month: parseInt(month, 10), 
                    price: { $gte: range.min, $lte: range.max }
                });
                chartData.push({ range: range.range, count }); 
            } catch (error) {
                console.error(`Error fetching data for range ${range.range}:`, error);
                chartData.push({ range: range.range, count: 0 }); 
            }
        }

        res.status(200).json(chartData);
    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// api 4: Get pie chart data

app.get('/api/transactions/pie-chart', async (req, res) => {
    const { month } = req.query;

    if (!month) {
        return res.status(400).json({ message: 'Month is required for pie chart data' });
    }

    try {
      
        const soldCountPromise = Transaction.countDocuments({
            month: parseInt(month, 10),
            sold: true
        });

        const notSoldCountPromise = Transaction.countDocuments({
            month: parseInt(month, 10), 
            sold: false
        });

       
        const [soldCount, notSoldCount] = await Promise.all([soldCountPromise, notSoldCountPromise]);

        res.status(200).json({ sold: soldCount, notSold: notSoldCount });
    } catch (error) {
        console.error('Error fetching pie chart data:', error.message || error);
        res.status(500).send('Error fetching pie chart data');
    }
});


// api 5:combined data from all three api
app.get('/api/transactions/combined-data', async (req, res) => {
    const { month } = req.query;

    if (!month) {
        return res.status(400).json({ message: 'Month is required for the combined response' });
    }

    try {
        const transactionsResponse = await axios.get(`http://localhost:${PORT}/api/transactions?month=${month}`);
        const statsResponse = await axios.get(`http://localhost:${PORT}/api/transactions/stats?month=${month}`);
        const barChartResponse = await axios.get(`http://localhost:${PORT}/api/transactions/bar-chart?month=${month}`);
        const pieChartResponse = await axios.get(`http://localhost:${PORT}/api/transactions/pie-chart?month=${month}`);

        const combinedResponse = {
            transactions: transactionsResponse.data,
            statistics: statsResponse.data,
            barChartData: barChartResponse.data,
            pieChartData: pieChartResponse.data
        };

        res.status(200).json(combinedResponse);
    } catch (error) {
        console.error('Error fetching combined data:', error);
        res.status(500).json({ message: 'Internal server error while fetching combined data' });
    }
});

// api 6: Get transaction by id
app.get('/api/transactions/:id', async (req, res) => {
    try {
        const transaction = await Transaction.findOne({ id: req.params.id });
        if (transaction) {
            res.status(200).json(transaction);
        } else {
            res.status(404).json({ message: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).send('Error fetching transaction');
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
